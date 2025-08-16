import  pool  from "../config/db.js";
import bycrpt from 'bcrypt'
import jwt from 'jsonwebtoken';


export const createUser=async(req,res)=>{
    try {
        
        
        const{fullname,email,password}=req.body;

        if(!fullname || !email || !password){
            return res.status(400).json("required credentials are missing");
        }
        const { rowCount: exists } = await pool.query(
            "SELECT 1 FROM users WHERE email = $1",
            [email]
          );
          if (exists) {
            return res.status(409).json({ error: "Email already registered" });
          }
        const hashPassword=await bycrpt.hash(password,10)
        const query=`INSERT INTO users (fullname,email,password) VALUES ($1, $2, $3)`;
        const values=[fullname,email,hashPassword];

        const result=await pool.query(query,values);

        res.status(201).json({
            message:"user created successfully"
        })
    } catch (error) {
            res.status(500).json({error:"server error"});
    }


}

export const loginUser=async(req,res)=>{

    const {email,password}=req.body;

    console.log(email,password)
    if(!email || !password){
        return res.status(401).json({
            message:"Invalid email or password"
        })
    }
    try {

        const result=await pool.query(`SELECT *FROM users WHERE email=$1 `,[email]);
        console.log(result)
        
        if(result.rows.length===0){
           return  res.status(401).json({message:"Invalid email or password"});

        }
        const user=result.rows[0];

        const isMatch=await bycrpt.compare(password,user.password);
        if(!isMatch){

            return res.status(401).json({message:"Invalid email or password"});
        }
        const token=jwt.sign({id:user.id,email:user.email},process.env.SECRET,{
            expiresIn:'1hr'
        })
        res.status(201).json({
            message:"login successful",
            token,
            user:{
                id:user.id,
                fullname:user.fullname,
                email:user.email
            }
        })
        
    } catch (error) {
        res.status(500).json({error:"server error"});
    }
}

